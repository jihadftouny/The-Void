/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

import java.util.Random;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 *
 * @author jihad
 */
public class Player extends Character {

    Random rand = new Random();

    //additional variables
    int gold, restsLeft, pots;

    //upgrades variables
    public int numAtkUpgrades, numDefUpgrades;

    public String[] atkUpgrades = {"Strength", "Power", "Might", "Warlike"};
    public String[] defUpgrades = {"Heavy Bones", "Stoneskin", "Scale Armor", "Holy Armor"};

    //constructor
    public Player(String name) {
        //calling constructor of superclass
        super(name, 10, 0); //name maxhp xp

        //setting #upgrades to 0
        this.numAtkUpgrades = 0;
        this.numDefUpgrades = 0;

        //player stats
        //set additional stats
        this.gold = 5;
        this.restsLeft = 1;
        this.pots = 2;
        //let player choose trait when creating character
        rollStartStats();
//        chooseTrait();

    }

    public void rollStartStats() {
        //were to roll a d6 4 times, pick 3 highest, and add them to an array. then from this array, player can arrange it as he wishes, player can also re-roll
        //pseudo code
        //for loop 6 iterations{
        //rolldice 4d6, add 3 highest to array as next index
        //display all indexes in the GameLogic.readInt()
//STR,DEX,CON,INT,WIS,CHA,
        boolean startStatsSet = false;
        do {
            for (int i = 0; i < 6; i++) {
                int roll = Dice.rollDice(Dice.startStatsDice);
                roll -= Dice.startStatsDice.smallestRoll;
                Stats[i] = roll;
                System.out.println(Stats[i]); //debug
            }
            
            GameLogic.printHeader("YOUR ROLLS", true);
            System.out.println("STR: " + Stats[0] + "\nDEX: " + Stats[1] + "\nCON: " + Stats[2] + "\nINT: " + Stats[3] + "\nWIS: " + Stats[4] + "\nCHA: " + Stats[5]); //debug
            System.out.println("Do you want to have these attributes?\n(1) Yes, looking good!\n(2) No, re-roll them!");
            int input = GameLogic.readInt("-> ", 2);
            
            if(input == 1 ){
                startStatsSet = true;
            }else{
                System.out.println("Re-rolling stats. . .");
                try {
                    Thread.sleep(1000);
                } catch (InterruptedException ex) {
                    Logger.getLogger(Player.class.getName()).log(Level.SEVERE, null, ex);
                }
            }
            
        } while (!startStatsSet);

        
        GameLogic.anythingToContinue();

    }

    // player specific methods
    public void chooseTrait() {
        GameLogic.clearConsole();
        int roll = Dice.rollDice(Dice.d10);
        GameLogic.printHeader("Choose an upgrade", true);
        System.out.println("(1) " + atkUpgrades[numAtkUpgrades]);
        System.out.println("(2) " + defUpgrades[numDefUpgrades]);
        int input = GameLogic.readInt("-> ", 2);

        if (input == 1) {
            GameLogic.clearConsole();
            System.out.println("You chose " + atkUpgrades[numAtkUpgrades] + ".");
            numAtkUpgrades++;
            Stats[0] += roll;
        } else {
            GameLogic.clearConsole();
            System.out.println("You chose " + defUpgrades[numDefUpgrades] + ".");
            numDefUpgrades++;
            Stats[1] += roll;
        }
        System.out.println("roll: " + roll + "\n ATK: " + Stats[0] + " DEF: " + Stats[1]);
        GameLogic.anythingToContinue();
    }

    @Override
    public int attack() {

        return rand.nextInt(Stats[0]);
//        return (int) (Math.random()*(xp/4 + numAtkUpgrades*3 +3) + xp/10 + numAtkUpgrades*2 + numDefUpgrades +1);
    }

    @Override
    public int defend() {
        return rand.nextInt(Stats[1]);
//        return (int) (Math.random() * (xp / 4 + numDefUpgrades * 3 + 3) + xp / 10 + numDefUpgrades * 2 + numAtkUpgrades + 1);
    }

}
