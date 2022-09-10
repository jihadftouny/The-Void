/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

import java.util.ArrayList;

/**
 *
 * @author jihad
 */
public abstract class Character {

    //BIG
    //BIG BIG BIG IMPORTANT NOTE:::::::::::::::::::::::::::::::::::
    // might have to create methods like attack() and defend() (overidable) to set player stats everytime an item is equipped
    // will have to create setArmor, setWeapon, etc. both for player and enemies, while also randomly picking one from a range to enemies
    
    
    //variables
    String name;
    int hp, maxHp, xp, skillCharges;
    public int[] Stats; //every level up player has x points to spend on his attributes
    int armorClass;
    int maxSkillCharges;
    ArrayList<Skill> skillPool;
    public static ArrayList<Condition> activeConditions;

    //modifiers
    public int[] StatsMods; // strM, dexM, conM, intM, wisM, chaM;

    String[] EquipmentOn;

    public Character(String name, int maxHp, int xp) {
        this.Stats = new int[]{10, 10, 10, 10, 10, 10}; //STR,DEX,CON,INT,WIS,CHA, -future update - CON(hp), AGI (chance to dodge), INT (when we add spells) - - also make every upgrade a bigger difference
        this.StatsMods = new int[]{0, 0, 0, 0, 0, 0};
        this.armorClass = 10;
        this.EquipmentOn = new String[]{"", "", ""};
        this.name = name;
        this.maxHp = maxHp;
        this.xp = xp;
        hp = maxHp;
        
        
        
        
    }

    //methods every character has
    public abstract int attack();

    public abstract int defend();
    
    public abstract void setArmorClass();
    
    public abstract int atkRoll();

    //the below function will set all the stat modifiers everytime a character is created or level ups.
    public void setMods() {
        int currentConMod = StatsMods[2];

        for (int i = 0; i < 6; i++) {
            if (Stats[i] == 30) {
                StatsMods[i] = 10;
            } else if (Stats[i] >= 28) {
                StatsMods[i] = 9;
            } else if (Stats[i] >= 26) {
                StatsMods[i] = 8;
            } else if (Stats[i] >= 24) {
                StatsMods[i] = 7;
            } else if (Stats[i] >= 22) {
                StatsMods[i] = 6;
            } else if (Stats[i] >= 20) {
                StatsMods[i] = 5;
            } else if (Stats[i] >= 18) {
                StatsMods[i] = 4;
            } else if (Stats[i] >= 16) {
                StatsMods[i] = 3;
            } else if (Stats[i] >= 14) {
                StatsMods[i] = 2;
            } else if (Stats[i] >= 12) {
                StatsMods[i] = 1;
            } else if (Stats[i] >= 10) {
                StatsMods[i] = 0;
            } else if (Stats[i] >= 8) {
                StatsMods[i] = -1;
            } else if (Stats[i] >= 6) {
                StatsMods[i] = -2;
            } else if (Stats[i] >= 4) {
                StatsMods[i] = -3;
            } else if (Stats[i] >= 2) {
                StatsMods[i] = -4;
            } else { // Stats is 1
                StatsMods[i] = -5;
            }
        }

        int newConMod = StatsMods[2];
        int roll;

        if (Player.isLevelUp) {
            switch (GameLogic.act) {
                case 2: //chapter/lvl 2
                    roll = Dice.rollDice(Player.hitDiePlayer) + StatsMods[2];
                    Player.hitDiePlayer.quantity = 2;
                    break;
                case 3: //chapter/lvl 3
                    roll = Dice.rollDice(Player.hitDiePlayer) + StatsMods[2];
                    Player.hitDiePlayer.quantity = 3;
                    break;
                case 4: //chapter/lvl 4
                    roll = Dice.rollDice(Player.hitDiePlayer) + StatsMods[2];
                    Player.hitDiePlayer.quantity = 4;
                    break;
                default: //chapter/lvl 5
                    roll = Dice.rollDice(Player.hitDiePlayer) + StatsMods[2];
                    Player.hitDiePlayer.quantity = 5;
                    break;
            }

            if (roll < 1)
                roll = 1;
            

            maxHp += roll;
            System.out.println("extra hp roll: " + roll);

            if (currentConMod != newConMod) {
                System.out.println("new CON mod !");
                maxHp += GameLogic.act - 1;
            }

        }
    }

}
