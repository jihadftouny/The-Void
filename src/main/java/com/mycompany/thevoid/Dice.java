/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

import java.util.Random;
import jdk.nashorn.internal.codegen.CompilerConstants;

/**
 *
 * @author jihad
 */
/**
 * the game is going to run on a dice system (for its battle), so there will be
 * different amounts of dice, of various sizes. for example, 2d6, 3d8, 1d20, etc
 *
 * MAYBE Object concept is not necessary
 */
public class Dice {

    public int quantity, sides; //sides can be 2,4,6,8,10,12,20
    public static int smallestRoll;
//    public int totalRoll, currentRoll;
    
    // DICES
        //NEW CHARACTER DIE
    public static Dice startStatsDice = new Dice(4,6);
    
    // SINGLE DIE
        //SINGLE DIE
    public static Dice d2 = new Dice(1, 2);
    public static Dice d4 = new Dice(1, 4);
    public static Dice d6 = new Dice(1, 6);
    public static Dice d8 = new Dice(1, 8);
    public static Dice d10 = new Dice(1, 10);
    public static Dice d12 = new Dice(1, 12);
    public static Dice d20 = new Dice(1, 20);
    
    
    public Dice(int quantity, int sides) {
        this.quantity = quantity;
        this.sides = sides;
    }

    
    

    public static int rollDice(Dice dice) { //later on maybe use number of sides to make an array, with each dice being a index, and result being last one
        Random rand = new Random();
        int totalRoll = 0;
        smallestRoll = dice.sides;
        for (int i = 0; i < dice.quantity; i++) {

            int currentRoll = 1 + rand.nextInt(dice.sides);
            if(currentRoll < smallestRoll)
                smallestRoll = currentRoll;
            
            totalRoll += currentRoll;
            System.out.println("current roll " + currentRoll); //test
        }
        System.out.println("total roll " + totalRoll); //test
        return totalRoll;

    }

}
