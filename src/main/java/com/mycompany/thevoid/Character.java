/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

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
    int hp, maxHp, xp;
    public static int[] Stats; //every level up player has x points to spend on his attributes
    int ArmorClass;

    //modifiers
    public static int[] StatsMods; // strM, dexM, conM, intM, wisM, chaM;

    String[] EquipmentOn;

    public Character(String name, int maxHp, int xp) {
        this.Stats = new int[]{10, 10, 10, 10, 10, 10}; //STR,DEX,CON,INT,WIS,CHA, -future update - CON(hp), AGI (chance to dodge), INT (when we add spells) - - also make every upgrade a bigger difference
        this.StatsMods = new int[]{0, 0, 0, 0, 0, 0};
        this.ArmorClass = 10;
        this.EquipmentOn = new String[]{"", "", ""};
        this.name = name;
        this.maxHp = maxHp;
        this.xp = xp;
        hp = maxHp;
    }

    //methods every character has
    public abstract int attack();

    public abstract int defend();

    //the below function will set all the stat modifiers everytime a character is created or level ups.
    public static void setMods() {
        for (int i = 0; i < 6; i++) {
            if (Stats[i] == 30){
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
    }
}
